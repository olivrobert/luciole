<?php

declare(strict_types=1);

namespace Reader\Application\Message\Command\FavoriteBook\ToggleFavoriteBook;

use Reader\Application\Message\Command\FavoriteBook\AddFavoriteBook\AddFavoriteBook;
use Reader\Application\Message\Command\FavoriteBook\RemoveFavoriteBook\RemoveFavoriteBook;
use Reader\Domain\Exception\BookCopyNotAvailableException;
use Reader\Domain\Repository\FavoriteBook\FavoriteBookRepositoryInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Messenger\MessageBusInterface;

#[AsMessageHandler(bus: 'command.bus')]
final readonly class ToggleFavoriteBookHandler
{
    public function __construct(
        private FavoriteBookRepositoryInterface $favoriteBookRepository,
        #[Autowire(service: 'command.bus')]
        private MessageBusInterface $commandBus,
    ) {
    }

    public function __invoke(ToggleFavoriteBook $command): void
    {
        if ($this->favoriteBookRepository->existsForReaderAndBookCopy($command->reader, $command->bookCopy)) {
            $this->commandBus->dispatch(new RemoveFavoriteBook($command->reader, $command->bookCopy));

            return;
        }

        if (!$command->bookCopy->status->isAvailable()) {
            throw new BookCopyNotAvailableException();
        }

        $this->commandBus->dispatch(new AddFavoriteBook($command->reader, $command->bookCopy));
    }
}
