<?php

declare(strict_types=1);

namespace Reader\Infrastructure\Symfony\Controller\App\Loan;

use Reader\Application\Message\Query\GetLoanHistory\GetLoanHistory;
use Reader\Domain\Model\Reader;
use Reader\Infrastructure\Symfony\Voter\ReaderVoter;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\HandledStamp;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/{id}/loans', name: 'reader_loans', methods: [Request::METHOD_GET], requirements: ['id' => '\d+'])]
#[IsGranted(ReaderVoter::VIEW, subject: 'reader')]
final class HistoryController extends AbstractController
{
    public function __invoke(Reader $reader, MessageBusInterface $queryBus): Response
    {
        $loans = $queryBus
            ->dispatch(new GetLoanHistory($reader))
            ->last(HandledStamp::class)
            ?->getResult() ?? [];

        return $this->render('admin/reader/loan/history.html.twig', [
            'reader' => $reader,
            'loans' => $loans,
        ]);
    }
}
