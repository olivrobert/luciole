<?php

declare(strict_types=1);

namespace Reader\Application\Message\Command\ArchiveReader;

use Common\Domain\Adapter\MailerInterface;
use Reader\Domain\Exception\ActiveLoansException;
use Reader\Domain\Model\Reader;
use Reader\Domain\Notification\ArchiveEmail;
use Reader\Domain\Repository\ReaderRepositoryInterface;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class ArchiveReaderHandler
{
    public function __construct(
        private ReaderRepositoryInterface $readerRepository,
        private MailerInterface $mailer,
    ) {
    }

    public function __invoke(ArchiveReader $command): void
    {
        $reader = $command->reader;

        if ($reader->hasActiveLoans()) {
            throw new ActiveLoansException();
        }

        $reader->archive();
        $this->readerRepository->save($reader);

        $this->notify($reader);
    }

    public function notify(Reader $reader): void
    {
        if (null === $reader->email) {
            return;
        }

        $this->mailer->send(new ArchiveEmail($reader));
    }
}
