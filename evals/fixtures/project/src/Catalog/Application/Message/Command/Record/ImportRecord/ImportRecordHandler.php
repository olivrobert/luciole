<?php

declare(strict_types=1);

namespace Catalog\Application\Message\Command\Record\ImportRecord;

use Catalog\Domain\Adapter\NationalCatalogInterface;
use Catalog\Domain\Event\RecordImported;
use Catalog\Domain\Exception\IsbnAlreadyCatalogedException;
use Catalog\Domain\Model\Book;
use Catalog\Domain\Repository\BookRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\Envelope;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\DispatchAfterCurrentBusStamp;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class ImportRecordHandler
{
    public function __construct(
        private BookRepositoryInterface $bookRepository,
        private NationalCatalogInterface $nationalCatalog,
        #[Autowire(service: 'event.bus')]
        private MessageBusInterface $eventBus,
    ) {
    }

    public function __invoke(ImportRecord $command): Book
    {
        if (null !== $this->bookRepository->findByIsbn($command->isbn)) {
            throw new IsbnAlreadyCatalogedException($command->isbn);
        }

        $record = $this->nationalCatalog->fetch($command->isbn);
        $book = Book::fromRecord($record);

        $this->bookRepository->save($book);

        $bookId = $book->getId();
        if (null === $bookId) {
            throw new \LogicException('Book without identifier after saving.');
        }

        $this->eventBus->dispatch(
            (new Envelope(new RecordImported($bookId)))->with(new DispatchAfterCurrentBusStamp()),
        );

        return $book;
    }
}
